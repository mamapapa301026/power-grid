const localOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost:5173',
  'https://127.0.0.1:5173',
]

export function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.CORS_ORIGIN
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return configuredOrigins?.length ? configuredOrigins : localOrigins
}
