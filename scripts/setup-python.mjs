import { resolve } from 'node:path';
import { installPython } from '../src/python.mjs';
try {
  const python = await installPython({
    target: resolve('.venv'), requirements: resolve('python/requirements.txt'),
    ...(process.argv[2] ? { basePython: process.argv[2] } : {}),
  });
  console.log('读取环境就绪：' + python);
} catch (error) { console.error(error.message); process.exitCode = 1; }
