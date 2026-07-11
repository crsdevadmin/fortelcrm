import client from './client';

// ── AUTH ──────────────────────────────────────
export const authAPI = {
  me: (token) => client.get(`/auth/me?token=${token}`),
  googleLogin: () => { window.location.href = `${process.env.REACT_APP_API_URL || ''}/auth/google/login`; },
};

// ── USERS ────────────────────────────────────
export const usersAPI = {
  list: (role, viewer_id) => client.get('/users/', { params: { role, viewer_id } }),
  get: (id) => client.get(`/users/${id}`),
  hierarchy: () => client.get('/users/hierarchy'),
  pendingApprovals: () => client.get('/users/pending-approvals'),
  approve: (id, role, manager_id, director_id) =>
    client.post(`/users/${id}/approve`, null, { params: { role, manager_id, director_id, approver_id: 1 } }),
  reject: (id) => client.post(`/users/${id}/reject`),
  changeReporting: (id, manager_id, director_id) =>
    client.patch(`/users/${id}/change-reporting`, null, { params: { new_manager_id: manager_id, new_director_id: director_id } }),
  deactivate: (id) => client.delete(`/users/${id}`),
};

// ── SALES ────────────────────────────────────
export const salesAPI = {
  submit: (payload) => client.post('/sales/submit', payload),
  doctorMonthly: (doctorId, year, month) =>
    client.get(`/sales/doctor/${doctorId}/monthly`, { params: { year, month } }),
  doctorSummary: (doctorId) => client.get(`/sales/doctor/${doctorId}/summary`),
  regionMonthly: (managerId, year, month) =>
    client.get(`/sales/region/${managerId}/monthly`, { params: { year, month } }),
  byProduct: (year, month) => client.get('/sales/by-product', { params: { year, month } }),
  weeklyReminderStatus: (userId, today) =>
    client.get('/sales/weekly-reminder-status', { params: { user_id: userId, today } }),
  approveEntry: (id, approverId) =>
    client.post(`/sales/${id}/approve`, null, { params: { approver_id: approverId } }),
};

// ── INVESTMENTS ───────────────────────────────
export const investmentsAPI = {
  submit: (payload) => client.post('/investments/', payload),
  doctorInvestments: (doctorId) => client.get(`/investments/doctor/${doctorId}`),
  doctorTotal: (doctorId) => client.get(`/investments/doctor/${doctorId}/total`),
  byCategory: (year, month) => client.get('/investments/summary/by-category', { params: { year, month } }),
  pendingApprovals: () => client.get('/investments/pending-approvals'),
  approve: (id, approverId) =>
    client.post(`/investments/${id}/approve`, null, { params: { approver_id: approverId } }),
};

// ── ROI ───────────────────────────────────────
export const roiAPI = {
  doctor: (doctorId, year, month) =>
    client.get(`/roi/doctor/${doctorId}`, { params: { year, month } }),
  doctorFull: (doctorId, year, month) =>
    client.get(`/roi/doctor/${doctorId}/full`, { params: { year, month } }),
  allDoctors: (year, month, params = {}) =>
    client.get('/roi/all-doctors', { params: { year, month, ...params } }),
  allDoctorsByDate: (startDate, endDate, params = {}) =>
    client.get('/roi/all-doctors', { params: { year: 0, month: 0, start_date: startDate, end_date: endDate, ...params } }),
  gradeSummary: (year, month, extra = {}) =>
    client.get('/roi/grade-summary', { params: { year, month, ...extra } }),
  clientStats: (year, month, params = {}) =>
    client.get('/roi/client-stats', { params: { year, month, ...params } }),
  atRisk: (year, month) =>
    client.get('/roi/at-risk', { params: { year, month } }),
  productsSummary: (year, month) =>
    client.get('/roi/products-summary', { params: { year, month } }),
  spendAnalysis: (year, month, params = {}) =>
    client.get('/investments/spend-analysis', { params: { year, month, ...params } }),
  concentrationRisk: (year, month, params = {}) =>
    client.get('/investments/concentration-risk', { params: { year, month, ...params } }),
  updateCommercial: (doctorId, payload) =>
    client.patch(`/roi/doctor/${doctorId}/commercial`, payload),
};

// ── PRODUCTS ─────────────────────────────────
export const productsAPI = {
  list: () => client.get('/products/'),
  create: (payload) => client.post('/products/', payload),
  deactivate: (id) => client.delete(`/products/${id}`),
};

export const targetsAPI = {
  assignees: (actorId) => client.get('/targets/assignees', { params: { actor_id: actorId } }),
  context: (actorId, ownerUserId, year, month) =>
    client.get('/targets/context', { params: { actor_id: actorId, owner_user_id: ownerUserId, year, month } }),
  summary: (userId, year, month) =>
    client.get('/targets/summary', { params: { user_id: userId, year, month } }),
  save: (payload) => client.post('/targets/', payload),
};

// ── EXPORTS ───────────────────────────────────
const API_BASE = process.env.REACT_APP_API_URL || '';

export const exportsAPI = {
  // These return file downloads — use window.open or anchor href
  salesUrl: (year, month, params = {}) => {
    const qs = new URLSearchParams({ year, month, ...params }).toString();
    return `${API_BASE}/exports/sales?${qs}`;
  },
  repActivityUrl: (year, month, params = {}) => {
    const qs = new URLSearchParams({ year, month, ...params }).toString();
    return `${API_BASE}/exports/rep-activity?${qs}`;
  },
  doctorMasterUrl: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${API_BASE}/exports/doctor-master${qs ? '?' + qs : ''}`;
  },
  // JSON version for dashboard screen
  repActivityData: (year, month, params = {}) =>
    client.get('/exports/rep-activity-data', { params: { year, month, ...params } }),
};

// ── REGIONS ───────────────────────────────────
export const regionsAPI = {
  states: () => client.get('/regions/states'),
  list: () => client.get('/regions/'),
  assign: (state_codes, manager_id) =>
    client.post('/regions/assign', { state_codes, manager_id }),
  removeManager: (stateCode) => client.delete(`/regions/${stateCode}/remove-manager`),
  managerRegions: (managerId) => client.get(`/regions/manager/${managerId}`),
};
