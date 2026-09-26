// Thread bootstrap: registers tsx so that the TypeScript worker can be loaded.
import { register } from 'tsx/esm/api';

register();
await import('./eval-worker.ts');
