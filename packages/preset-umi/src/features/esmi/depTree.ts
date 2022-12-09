import Arborist from '@npmcli/arborist';
import path from 'path';
import type { IApi } from '../../types';

export async function getDepTree(
  data: NonNullable<IApi['appData']['deps']>,
): Promise<any> {
  const arborist = new Arborist({
    path: process.cwd(),
    lockfileVersion: 3,
    update: false,
    log: 'error' as any,
    legacyPeerDeps: false,
    strictPeerDeps: false,
  });
  const idealTree = await arborist.loadActual({});
  const meta = idealTree.meta!;
  const lock = meta.commit();
  const { packages } = lock;

  if (!packages) throw new Error('本地生成依赖树失败');

  const packageKeys = Object.keys(packages);

  const result: Record<string, any> = {};

  function collectDependencies(name: string, orders: string[]) {
    const pkgJson = packages![name];
    const { dependencies = {} } = pkgJson;

    Object.keys(dependencies).forEach((dep) => {
      const isCircularDependency = orders.some((n) => n === dep);
      // 检查循环依赖
      if (!isCircularDependency) {
        let findKey = [name, 'node_modules', dep].join(path.sep);
        while (findKey && !packageKeys.includes(findKey)) {
          const findPaths = findKey.split('node_modules');
          findPaths.splice(findPaths.length - 2, 1);
          findKey = findPaths.join('node_modules');
        }

        result[findKey] = packages![findKey];
        collectDependencies(findKey, orders.concat(dep));
      }
    });
  }

  Object.entries(data).forEach(([name, info]) => {
    // 判断是否是 @umijs/plugin 提供的依赖
    const umijsPluginPath = [
      'node_modules',
      '@umijs/plugins',
      'node_modules',
      name,
    ].join(path.sep);
    const isUmiPluginDependency = info.matches.some((m) =>
      m.includes(umijsPluginPath),
    );

    let pkgKey = packageKeys.find(
      (n) => n === ['node_modules', name].join(path.sep),
    );

    if (isUmiPluginDependency) {
      pkgKey = packageKeys.find((n) => n === umijsPluginPath) ?? pkgKey;
    }

    if (pkgKey) {
      result[pkgKey] = packages[pkgKey];
      collectDependencies(pkgKey, [name]);
    }
  });

  return {
    packageLockJson: {
      packages: result,
      dependencies: {},
    },
  };
}