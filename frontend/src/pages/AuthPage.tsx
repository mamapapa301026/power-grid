import { useState, type FormEvent } from 'react'
import { LockKeyhole, LogIn, UserPlus, Zap } from 'lucide-react'
import { ApiError, api } from '../api/client'
import type { AuthSession } from '../api/client'

type Props = {
  setupRequired: boolean
  serverError: string
  onAuthenticated: (session: AuthSession) => void
  onRetry: () => void
}

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Неверный логин или пароль'
    if (error.status === 409) return 'Такой логин уже зарегистрирован'
    if (error.status === 400) return 'Проверьте поля и длину пароля (не менее 10 символов)'
  }
  return error instanceof Error ? error.message : 'Не удалось подключиться к локальному серверу'
}

function AuthPage({ setupRequired, serverError, onAuthenticated, onRetry }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>(setupRequired ? 'register' : 'login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = mode === 'register'
        ? await api.register({ username, displayName, password })
        : await api.login({ username, password })
      onAuthenticated(session)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
          <div><strong>powergrid</strong><span>ЛОКАЛЬНАЯ СИСТЕМА</span></div>
        </div>
        <div className="auth-heading">
          <div className="auth-icon">{mode === 'register' ? <UserPlus size={19} /> : <LockKeyhole size={19} />}</div>
          <div>
            <div className="panel-kicker">{setupRequired ? 'ПЕРВОНАЧАЛЬНАЯ НАСТРОЙКА' : 'ЛОКАЛЬНАЯ УЧЁТНАЯ ЗАПИСЬ'}</div>
            <h1 id="auth-title">{mode === 'register' ? 'Создать аккаунт' : 'Войти в систему'}</h1>
          </div>
        </div>
        {setupRequired && <p className="auth-notice">Первый зарегистрированный пользователь станет администратором. Следующие аккаунты получают роль потребителя; администратор сможет назначить им другую роль.</p>}
        {!setupRequired && <div className="auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError('') }}>Вход</button>
          <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError('') }}>Регистрация</button>
        </div>}
        {serverError
          ? <div className="auth-error" role="alert">{serverError}<button type="button" className="text-action" onClick={onRetry}>Повторить</button></div>
          : <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'register' && <label>Имя и фамилия<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength={2} maxLength={100} required /></label>}
            <label>Логин<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]{3,32}" title="3–32 символа: латинские буквы, цифры, точка, дефис или подчёркивание" required /></label>
            <label>Пароль<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={10} maxLength={128} required /></label>
            {mode === 'register' && <small className="auth-hint">Не менее 10 символов. Пароль хранится только в виде криптографического хеша.</small>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button type="submit" className="button button-primary auth-submit" disabled={busy}>
              {mode === 'register' ? <UserPlus size={15} /> : <LogIn size={15} />}
              {busy ? 'Подождите…' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}
            </button>
          </form>}
        <div className="auth-local-note"><LockKeyhole size={13} /> Локальный вход · без внешних аккаунтов и передачи данных</div>
      </section>
    </main>
  )
}

export default AuthPage
