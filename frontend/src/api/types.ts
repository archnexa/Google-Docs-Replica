export type Role = 'owner' | 'editor' | 'viewer'
export type ShareRole = Exclude<Role, 'owner'>

export interface User {
  id: number
  email: string
  name: string
}

export interface DocumentSummary {
  id: string
  title: string
  owner: User
  role: Role
  updated_at: string
}

export interface DocumentDetail extends DocumentSummary {
  content: string
  version: number
  last_edited_by: User | null
}

export interface Share {
  id: number
  user: User
  role: ShareRole
}

export interface SaveResult {
  version: number
  updated_at: string
}

export interface ConflictBody {
  error: ApiErrorPayload
  current: {
    version: number
    content: string
    last_edited_by: User | null
    updated_at: string
  }
}

export interface ApiErrorPayload {
  code: string
  message: string
  fields?: Record<string, string[]>
}
