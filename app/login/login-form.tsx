"use client";

import { useActionState } from "react";

import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { error: null };

export function LoginForm({ redirectTo, initialError }: { redirectTo: string; initialError?: string | null }) {
  const [state, formAction, pending] = useActionState(loginAction, {
    error: initialError ?? initialState.error,
  } satisfies LoginFormState);

  return (
    <form action={formAction} className="login-form">
      <input name="redirect" type="hidden" value={redirectTo} />

      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
      </div>

      <div className="field">
        <label htmlFor="password">Adgangskode</label>
        <input autoComplete="current-password" id="password" name="password" required type="password" />
      </div>

      {state.error ? <p className="login-form__error">{state.error}</p> : null}

      <button className="button button--accent login-form__submit" disabled={pending} type="submit">
        {pending ? "Logger ind..." : "Log ind"}
      </button>
    </form>
  );
}
