export type AuthPrincipal = {
  subject: string
  username: string
  displayName: string
  roles: string[]
  substationIds: string[]
}