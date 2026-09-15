"use client";

import { useState } from "react";

/**
 * Zera a instalação do ambiente ativo (`POST /api/setup/reset`) pra permitir
 * reinstalar do zero — equivalente ao `DELETE /api/install` do projeto irmão
 * em PHP.
 *
 * O `external_id` em si já se renova sozinho (o health check gera um UUID
 * novo a cada chamada). O que isto resolve é o resto do estado: descartar
 * as credenciais do merchant de uma instalação antiga pra começar do zero,
 * e deixar o checkout explicitamente bloqueado até a nova instalação
 * terminar, em vez de operar com meia instalação.
 *
 * Confirmação no clique porque isto descarta as credenciais do merchant
 * junto — depois disso, só reinstalando.
 */
export default function ResetInstallButton({ environment }: { environment: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function reset() {
    const confirmed = window.confirm(
      `Zerar a instalação de ${environment}?\n\nIsso apaga o external_id e as credenciais do merchant deste ambiente. Você vai precisar rodar a instalação de novo.`
    );
    if (!confirmed) return;

    setState("working");
    setMessage(null);
    try {
      const res = await fetch("/api/setup/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState("done");
      setMessage(data.message);
      // Recarrega pra refletir o status novo (página é server component).
      window.location.reload();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Erro ao zerar a instalação.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={reset}
        disabled={state === "working"}
        className="inline-flex w-fit items-center rounded-full border border-am-danger-text/40 px-4 py-2 text-sm font-medium text-am-danger-text hover:bg-am-danger-bg disabled:opacity-40"
      >
        {state === "working" ? "Zerando…" : "Zerar instalação deste ambiente"}
      </button>
      {message && (
        <p
          className={`text-xs ${
            state === "error" ? "text-am-danger-text" : "text-am-ink-muted"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
