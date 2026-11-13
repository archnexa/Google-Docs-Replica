import { request } from './client'
import type { DocumentDetail, DocumentSummary, SaveResult, Share, ShareRole, User } from './types'

export const api = {
  health: () => request<{ ok: boolean }>('/api/health/'),

  login: (email: string, password: string) =>
    request<{ token: string; user: User; expires_at: string }>('/api/auth/login/', {
      method: 'POST',
      json: { email, password },
      keepSessionOn401: true,
    }),
  logout: () => request<void>('/api/auth/logout/', { method: 'POST', keepSessionOn401: true }),
  me: () => request<User>('/api/auth/me/'),

  listDocuments: (scope: 'owned' | 'shared', signal?: AbortSignal) =>
    request<DocumentSummary[]>(`/api/documents/?scope=${scope}`, { signal }),
  createDocument: (title?: string) =>
    request<DocumentDetail>('/api/documents/', { method: 'POST', json: title ? { title } : {} }),
  getDocument: (id: string, signal?: AbortSignal) => request<DocumentDetail>(`/api/documents/${id}/`, { signal }),
  renameDocument: (id: string, title: string) =>
    request<DocumentDetail>(`/api/documents/${id}/`, { method: 'PATCH', json: { title }, keepSessionOn401: true }),
  saveContent: (id: string, body: { content: string; version: number; save_id: string }) =>
    request<SaveResult>(`/api/documents/${id}/content/`, { method: 'PUT', json: body, keepSessionOn401: true }),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}/`, { method: 'DELETE' }),
  importDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<DocumentDetail>('/api/documents/import/', { method: 'POST', form })
  },

  listShares: (docId: string) => request<Share[]>(`/api/documents/${docId}/shares/`),
  addShare: (docId: string, email: string, role: ShareRole) =>
    request<Share>(`/api/documents/${docId}/shares/`, { method: 'POST', json: { email, role } }),
  updateShare: (docId: string, shareId: number, role: ShareRole) =>
    request<Share>(`/api/documents/${docId}/shares/${shareId}/`, { method: 'PATCH', json: { role } }),
  removeShare: (docId: string, shareId: number) =>
    request<void>(`/api/documents/${docId}/shares/${shareId}/`, { method: 'DELETE' }),
}
