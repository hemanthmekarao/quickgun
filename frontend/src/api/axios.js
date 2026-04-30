import axios from 'axios';

const api = axios.create({ baseURL: '/' });

// Attach stored token automatically on every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export default api;
