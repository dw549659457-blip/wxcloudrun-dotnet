import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = `${root}aspnetapp/wwwroot/admin`;
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(`${root}apps/admin/dist`, target, { recursive: true });
console.log('管理后台静态文件已复制到 aspnetapp/wwwroot/admin');
