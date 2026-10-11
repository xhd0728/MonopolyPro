import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({root:resolve('apps/client'),build:{outDir:resolve('dist/client'),emptyOutDir:true},server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:8788','/healthz':'http://127.0.0.1:8788','/matchmake':'http://127.0.0.1:8788'}}});
