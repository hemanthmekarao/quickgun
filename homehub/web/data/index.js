// Composition root for data: choose the adapter here, nowhere else.
import { Repository } from './repository.js';
import { localAdapter } from './adapters/localAdapter.js';

// To go cloud later:  import { httpAdapter } from './adapters/httpAdapter.js'
//                     new Repository(httpAdapter(settings.get().apiBase, getToken))
export const repo = new Repository(localAdapter);
