import type { BuildResult } from '@umijs/bundler-utils/compiled/esbuild';
import type { Declaration } from '@umijs/es-module-parser';
import { aliasUtils, importLazy, lodash, logger } from '@umijs/utils';
import path from 'path';
import { addUnWatch } from '../../commands/dev/watch';
import { IApi, IOnGenerateFiles } from '../../types';

const parser: typeof import('@umijs/es-module-parser') = importLazy(
  require.resolve('@umijs/es-module-parser'),
);

export default (api: IApi) => {
  function updateAppdata(prepareData: {
    buildResult: BuildResult;
    fileImports?: Record<string, Declaration[]>;
  }) {
    const buildResult: BuildResult = lodash.cloneDeep(prepareData.buildResult);
    (buildResult.outputFiles || []).forEach((file) => {
      // @ts-ignore
      delete file?.contents;
    });
    const nextFileImports =
      prepareData.fileImports ?? api.appData.prepare?.fileImports;
    api.appData.prepare = {
      buildResult,
      fileImports: nextFileImports,
    };
  }

  async function parseProjectImportSpecifiers(br: BuildResult) {
    const files = Object.keys(br.metafile!.inputs) || [];

    if (files.length === 0) {
      return {};
    }
    try {
      const start = Date.now();
      const fileImports = await parser.parseFiles(
        files.map((f) => path.join(api.paths.cwd, f)),
      );

      api.telemetry.record({
        name: 'parse',
        payload: { duration: Date.now() - start },
      });
      return fileImports;
    } catch (e) {
      api.telemetry.record({
        name: 'parse:error',
        payload: {},
      });
      return undefined;
    }
  }

  api.register({
    key: 'onGenerateFiles',
    async fn({ isFirstTime }: IOnGenerateFiles) {
      // do not support vue
      if (api.appData.framework === 'vue') {
        return;
      }
      if (!isFirstTime) return;
      logger.info('Preparing...');
      const entryFile = path.join(api.paths.absTmpPath, 'umi.ts');
      const { build } = await import('./build.js');
      const watch = api.name === 'dev';
      const plugins = await api.applyPlugins({
        key: 'addPrepareBuildPlugins',
        initialValue: [],
      });
      const unwrappedAlias = aliasUtils.parseCircleAlias({
        alias: api.config.alias,
      });
      const buildResult = await build({
        entryPoints: [entryFile],
        watch: watch && {
          async onRebuildSuccess({ result }) {
            const fileImports = await parseProjectImportSpecifiers(result);
            updateAppdata({ buildResult: result, fileImports });

            await api.applyPlugins({
              key: 'onPrepareBuildSuccess',
              args: {
                isWatch: true,
                result,
                fileImports,
              },
            });
          },
        },
        config: {
          alias: unwrappedAlias,
          cwd: api.paths.cwd,
        },
        plugins,
      });

      if (watch) {
        addUnWatch(() => {
          buildResult.stop?.();
        });
      }
      const fileImports = await parseProjectImportSpecifiers(buildResult);
      updateAppdata({ buildResult, fileImports });
      await api.applyPlugins({
        key: 'onPrepareBuildSuccess',
        args: {
          result: buildResult,
          fileImports,
        },
      });
    },
    stage: Infinity,
  });
};
