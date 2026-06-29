import axios from 'axios';

const client = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('fortel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — redirect to login
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fortel_token');
      localStorage.removeItem('fortel_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
