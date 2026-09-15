import { connection } from "next/server";
import { getAppmaxEnvironment, getAppBaseUrl, getValidateUrl } from "@/lib/appmax/config";
import { getExternalId, getMerchantCredentials } from "@/lib/appmax/state";
import ResetInstallButton from "@/app/components/ResetInstallButton";

async function tryGet<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string }> {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "erro desconhecido" };
  }
}

export default async function SetupPage() {
  // Sem isso, a página não usa nenhuma Request-time API e o Next a trata
  // como estática — gerada uma vez no build e nunca mais reavaliada. Como o
  // objetivo daqui é mostrar o status *atual* das env vars/instalação
  // (que muda depois de redeploys de env var ou depois do /setup/callback
  // em dev local), precisamos forçar renderização por requisição.
  await connection();

  const environment = getAppmaxEnvironment();
  const appBaseUrl = await tryGet(getAppBaseUrl);
  const validateUrl = await tryGet(getValidateUrl);
  const externalId = getExternalId();
  const merchantConfigured = Boolean(getMerchantCredentials());

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Setup da integração Appmax</h1>
        <p className="text-sm text-am-ink-muted">
          Esta página só existe para deixar o fluxo de instalação (App Store
          da Appmax) confortável — nada aqui deve ir para produção como está.
        </p>
      </header>

      <section
        className={`rounded-lg border p-4 text-sm ${
          environment === "production"
            ? "border-am-danger-text/30 bg-am-danger-bg text-am-danger-text"
            : "border-am-warn-text/30 bg-am-warn-bg text-am-warn-text"
        }`}
      >
        Instalando/operando em <strong className="uppercase">{environment}</strong>
        . Tudo abaixo (URL de validação, <code>external_id</code>, credenciais
        do merchant) é lido/gravado só para esse ambiente — sandbox e
        produção têm credenciais independentes (ver{" "}
        <a href="/configuracao" className="underline">
          /configuracao
        </a>
        ). Pra trocar de ambiente, use o seletor <strong>Ambiente</strong> no
        canto superior direito do header — a troca vale pro app inteiro,
        sem precisar de redeploy.
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-am-border bg-am-card p-5">
        <h2 className="font-medium">Status</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-am-ink-muted">APP_BASE_URL</dt>
          <dd className="font-mono">
            {appBaseUrl.value ?? (
              <span className="text-am-danger-text">{appBaseUrl.error}</span>
            )}
          </dd>

          <dt className="text-am-ink-muted">URL de validação</dt>
          <dd className="font-mono">{validateUrl.value ?? "—"}</dd>

          <dt className="text-am-ink-muted">external_id</dt>
          <dd className="font-mono">
            {externalId ?? (
              <span className="text-am-warn-text">
                ainda não gerado — sai do health check no passo 4
              </span>
            )}
          </dd>

          <dt className="text-am-ink-muted">Credenciais do merchant</dt>
          <dd>
            {merchantConfigured ? (
              <span className="text-am-success-text">configuradas ✓</span>
            ) : (
              <span className="text-am-warn-text">pendentes</span>
            )}
          </dd>
        </dl>
      </section>

      <section className="rounded-lg border border-am-warn-text/30 bg-am-warn-bg p-4 text-sm text-am-warn-text">
        Rodando num deploy serverless (Vercel)? O <code>.appmax/state.json</code>{" "}
        não sobrevive entre invocações lá — o filesystem de deploy é
        somente-leitura, e o SQLite junto. Como o <code>external_id</code> é
        lido <strong>só do banco</strong>, ali você precisa de um banco
        externo/persistente; e as credenciais do merchant que a página de
        resultado do passo 4 mostrar precisam ser copiadas à mão. Em dev local
        (<code>next dev</code>/<code>next start</code>), o arquivo funciona e
        cobre isso automaticamente.
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-am-border bg-am-card p-5">
        <h2 className="font-medium">Passo a passo</h2>
        <ol className="flex flex-col gap-4 text-sm text-am-ink">
          <li>
            <strong>1. Exponha este projeto publicamente via HTTPS.</strong> A Appmax
            não alcança <code>localhost</code> (nem para o health check, nem para o
            Apple Pay) — use algo como <code>ngrok http 3000</code> e abra
            <strong> essa URL do ngrok</strong> (não <code>localhost</code>) no
            navegador a partir de agora. Nada pra configurar: a URL pública é
            detectada sozinha a cada requisição (ver &quot;APP_BASE_URL&quot;
            acima) — se o túnel cair e você abrir outro, é só acessar pela
            nova URL, sem editar nada.
          </li>
          <li>
            <strong>2. Crie o aplicativo no painel da Appmax</strong> (
            <a
              className="underline"
              href="https://appstore.appmax.com.br"
              target="_blank"
              rel="noopener noreferrer"
            >
              appstore.appmax.com.br
            </a>
            ), tipo <em>privado</em>. Na URL de validação, cole exatamente o valor
            mostrado acima em &quot;URL de validação&quot;.
          </li>
          <li>
            <strong>3. Preencha as env vars</strong> com{" "}
            <code>APPMAX_APP_UUID</code>, <code>APPMAX_APP_NUMERICAL_ID</code>,{" "}
            <code>APPMAX_APP_CLIENT_ID</code> e <code>APPMAX_APP_CLIENT_SECRET</code>{" "}
            (em &quot;Consultar Aplicativo → Desenvolver&quot;). Redeploy (ou
            reinicie o <code>next dev</code>). O <code>external_id</code> você
            não precisa gerar: o health check do passo 4 cria e salva no banco
            sozinho — e é de lá, só de lá, que o front lê depois (env var não
            é mais consultada).
          </li>
          <li>
            <strong>4. Rode a instalação.</strong> O botão abaixo chama{" "}
            <code>POST /app/authorize</code> e te redireciona para a tela de
            autorização da Appmax. Autorize (você atua como o próprio
            merchant de teste) — a Appmax volta para{" "}
            <code>/api/setup/callback</code>, que troca o token pelas
            credenciais do merchant (disparando o health check no caminho) e
            mostra na tela o <code>APPMAX_MERCHANT_CLIENT_ID</code>/
            <code>APPMAX_MERCHANT_CLIENT_SECRET</code> pra você copiar.
          </li>
          <li>
            <strong>5. Cole as credenciais do merchant nas env vars</strong> e
            redeploy — só então <code>/</code> consegue processar pagamentos.
          </li>
        </ol>
        <a
          href="/api/setup/install"
          className="inline-flex w-fit items-center rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover"
        >
          Iniciar instalação →
        </a>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-am-border bg-am-card p-5 text-sm">
        <h2 className="font-medium">Recomeçar do zero</h2>
        <p className="text-am-ink-muted">
          O <code>external_id</code> se renova sozinho — o health check gera um
          UUID novo a cada chamada, como a{" "}
          <a
            href="https://docs.appmax.com.br/guides/implementar-url-validacao"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            doc exige
          </a>{" "}
          (a Appmax <strong>rejeita valores repetidos</strong>). O que zerar
          aqui resolve é o resto: descarta as credenciais do merchant de uma
          instalação antiga e deixa o checkout bloqueado até a nova terminar,
          em vez de operar com meia instalação.
        </p>
        <ResetInstallButton environment={environment} />
      </section>

      <p className="text-xs text-am-ink-muted">
        Depois de concluir, vá para <code>/</code> para testar o checkout com
        Apple Pay (precisa de Safari em macOS/iOS, com um cartão no Apple
        Wallet, acessando pela mesma URL pública).
      </p>
    </div>
  );
}
