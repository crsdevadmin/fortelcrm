import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);
const API = process.env.REACT_APP_API_URL || '';

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem('fortel_token');
    const u = localStorage.getItem('fortel_user');
    if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const res = await axios.post(`${API}/auth/login`, { email, password });
    const { access_token, user: userData, must_reset_password } = res.data;
    localStorage.setItem('fortel_token', access_token);
    localStorage.setItem('fortel_user', JSON.stringify(userData));
    setToken(access_token);
    setUser(userData);
    return { must_reset_password };
  };

  const changePassword = async (newPassword) => {
    await axios.post(`${API}/auth/change-password`, {
      token, new_password: newPassword
    });
    const updated = { ...user };
    localStorage.setItem('fortel_user', JSON.stringify(updated));
    setUser(updated);
  };

  const logout = () => {
    localStorage.removeItem('fortel_token');
    localStorage.removeItem('fortel_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, changePassword, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
