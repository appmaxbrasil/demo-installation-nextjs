"use client";

import { useEffect, useState } from "react";

type Environment = "sandbox" | "production";

/**
 * Seletor de ambiente ativo (sandbox/produção), visível no Header — troca
 * vale pro app inteiro (instalação, checkout, `/configuracao`), sem precisar
 * de redeploy nem editar `.env`. Ver `lib/db/settings.ts` e
 * `lib/appmax/config.ts#getAppmaxEnvironment`.
 *
 * Busca o valor atual direto da API (GET /api/environment) em vez de vir
 * como prop de Server Component: `/` e `/configuracao` são pré-renderizados
 * estaticamente, então um valor lido no server ficaria preso no ambiente do
 * build. Client component + fetch garante que reflete o banco de verdade a
 * cada carregamento.
 *
 * Produção em vermelho de propósito, igual ao resto do app: é o ambiente
 * onde clicar errado custa dinheiro de verdade.
 */
export default function EnvironmentSwitcher() {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/environment")
      .then((res) => res.json())
      .then((data) => setEnvironment(data.environment))
      .catch(() => {});
  }, []);

  async function switchTo(next: Environment) {
    if (next === environment || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error ?? "Falha ao trocar de ambiente.");
        return;
      }
      setEnvironment(next);
      // Reload completo (não só router.refresh): o script do AppmaxJS em `/`
      // já carregado no browser é pro ambiente antigo — mais simples e
      // confiável remontar a página inteira do que tentar trocar a <script>
      // src em runtime.
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b9b6d6]">
        Ambiente
      </span>
      <div className="flex overflow-hidden rounded-full border border-white/20">
        <button
          type="button"
          disabled={loading || environment === null}
          onClick={() => switchTo("sandbox")}
          className={`px-3 py-1 text-xs font-bold tracking-wide disabled:opacity-60 ${
            environment === "sandbox"
              ? "bg-[#8a5a00] text-white"
              : "bg-transparent text-[#b9b6d6] hover:text-white"
          }`}
        >
          SANDBOX
        </button>
        <button
          type="button"
          disabled={loading || environment === null}
          onClick={() => switchTo("production")}
          className={`px-3 py-1 text-xs font-bold tracking-wide disabled:opacity-60 ${
            environment === "production"
              ? "bg-[#8c1420] text-white"
              : "bg-transparent text-[#b9b6d6] hover:text-white"
          }`}
        >
          PRODUÇÃO
        </button>
      </div>
    </div>
  );
}
