import client from './client';

// ── AUTH ──────────────────────────────────────
export const authAPI = {
  me: () => client.get('/auth/me'),
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
  updateEntry: (id, payload) => client.patch(`/sales/${id}`, payload),
  deleteEntry: (id, associateId) => client.delete(`/sales/${id}`, { params: { associate_id: associateId } }),
  regional: (associateId, year, month, week, stateCode, city) => {
    const params = { associate_id: associateId };
    if (year !== undefined && year !== null) params.year = year;
    if (month !== undefined && month !== null) params.month = month;
    if (week !== undefined && week !== null) params.week = week;
    if (stateCode) params.state_code = stateCode;
    if (city) params.city = city;
    return client.get('/sales/regional', { params });
  },
  submitRegional: (payload) => client.post('/sales/regional/submit', payload),
  uploadRegionalWeekPdf: (formData) => client.post('/sales/regional/week-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  regionalWeekPdfs: (params) => client.get('/sales/regional/week-pdf/status', { params }),
  // viewer is derived from the auth token server-side; viewerId kept for call-site compatibility
  downloadRegionalWeekPdf: (viewerId, pdfId) => client.get('/sales/regional/week-pdf/download', {
    params: { pdf_id: pdfId }, responseType: 'blob',
  }),
};

async function chunkedPrimarySalesUpload(file, onProgress, basePath) {
  if (!window.crypto?.subtle) throw new Error('Secure file upload is not supported by this browser');
  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest('SHA-256', buffer);
  const checksum = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  const start = await client.post(`${basePath}/upload-session/start`, {
    filename: file.name,
    file_size: file.size,
    file_checksum: checksum,
  });
  const { session_id: sessionId, chunk_size: chunkSize, chunk_count: chunkCount } = start.data;
  onProgress?.(0, chunkCount);
  for (let index = 0; index < chunkCount; index += 1) {
    const bytes = new Uint8Array(buffer, index * chunkSize, Math.min(chunkSize, buffer.byteLength - (index * chunkSize)));
    const data = window.btoa(String.fromCharCode(...bytes));
    await client.post(`${basePath}/upload-session/${sessionId}/chunk`, { index, data });
    onProgress?.(index + 1, chunkCount);
  }
  return client.post(`${basePath}/upload-session/${sessionId}/complete`, { file_checksum: checksum });
}

// ── PRIMARY SALES (BACK-OFFICE EXCEL) ──────
export const primarySalesAPI = {
  summary: (params = {}) => client.get('/sales/primary/summary', { params }),
  citySplitSummary: (params = {}) => client.get('/sales/primary/city-split/summary', { params }),
  stockists: () => client.get('/sales/primary/stockists'),
  updateStockist: (id, payload) => client.patch(`/sales/primary/stockists/${id}`, payload),
  deleteUpload: (id, confirmation) => client.delete(`/sales/primary/uploads/${id}`, {
    data: { confirmation },
  }),
  deleteCitySplitUpload: (id, confirmation) => client.delete(`/sales/primary/city-split/uploads/${id}`, {
    data: { confirmation },
  }),
  upload: (file, onProgress) => chunkedPrimarySalesUpload(file, onProgress, '/sales/primary'),
  uploadCitySplit: (file, onProgress) => chunkedPrimarySalesUpload(file, onProgress, '/sales/primary/city-split'),
};

// ── INVESTMENTS ───────────────────────────────
export const investmentsAPI = {
  submit: (payload) => client.post('/investments/', payload),
  update: (id, payload) => client.patch(`/investments/${id}`, payload),
  delete: (id, associateId) => client.delete(`/investments/${id}`, { params: { associate_id: associateId } }),
  my: (associateId, year, month) => client.get('/investments/my', { params: { associate_id: associateId, year, month } }),
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
  doctorFull: (doctorId, year, month, viewerId, asOf) =>
    client.get(`/roi/doctor/${doctorId}/full`, { params: { year, month, viewer_id: viewerId, as_of: asOf } }),
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
  commitmentRecovery: (params = {}) =>
    client.get('/roi/commitment-recovery', { params }),
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
  dashboard: (viewerId, year, month, scope = 'overall', params = {}) =>
    client.get('/targets/dashboard', { params: { viewer_id: viewerId, year, month, scope, ...params } }),
  regionalContext: (actorId, ownerUserId, year, month, territory) =>
    client.get('/targets/regional-context', { params: { actor_id: actorId, owner_user_id: ownerUserId, year, month, territory } }),
  saveRegional: (payload) => client.post('/targets/regional', payload),
  save: (payload) => client.post('/targets/', payload),
};

export const tasksAPI = {
  assignees: (managerId) => client.get('/tasks/assignees', { params: { manager_id: managerId } }),
  list: (viewerId, params = {}) => client.get('/tasks/', { params: { viewer_id: viewerId, ...params } }),
  create: (payload) => client.post('/tasks/', payload),
  markRead: (taskId, userId) => client.patch(`/tasks/${taskId}/read`, null, { params: { user_id: userId } }),
  complete: (taskId, userId, comments) => client.patch(`/tasks/${taskId}/complete`, { user_id: userId, comments }),
};

export const dashboardAPI = {
  actionCenter: (viewerId, scope = 'overall', params = {}) =>
    client.get('/targets/action-center', { params: { viewer_id: viewerId, scope, ...params } }),
  territoryPerformance: (viewerId, year, month, scope = 'overall', params = {}) =>
    client.get('/targets/territory-performance', { params: { viewer_id: viewerId, year, month, scope, ...params } }),
  repScorecard: (viewerId, year, month, scope = 'overall', params = {}) =>
    client.get('/targets/rep-scorecard', { params: { viewer_id: viewerId, year, month, scope, ...params } }),
};

export const reportsAPI = {
  weekly: (params = {}) => client.get('/reports/weekly', { params }),
  history: (viewerId, scope = 'overall') => client.get('/reports/weekly/history', { params: { viewer_id: viewerId, scope } }),
  downloadPdf: (reportId) => client.get(`/reports/weekly/${reportId}/pdf`, { responseType: 'blob' }),
};

// ── EXPORTS ───────────────────────────────────
export const exportsAPI = {
  sales: (year, month, params = {}) => client.get('/exports/sales', { params: { year, month, ...params }, responseType: 'blob' }),
  repActivity: (year, month, params = {}) => client.get('/exports/rep-activity', { params: { year, month, ...params }, responseType: 'blob' }),
  doctorMaster: (params = {}) => client.get('/exports/doctor-master', { params, responseType: 'blob' }),
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
