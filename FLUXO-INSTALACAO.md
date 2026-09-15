# Fluxo de instalação — passo a passo

Mapa em uma tela:

```
Você                  /setup              Appmax                /api/appmax/validate   /api/setup/callback
 │                      │                    │                          │                       │
 │  clica "Iniciar       │                    │                          │                       │
 │  instalação" ────────>│                    │                          │                       │
 │                      │ POST /app/authorize │                          │                       │
 │                      │───────────────────>│                          │                       │
 │                      │  { token: hash }    │                          │                       │
 │                      │<───────────────────│                          │                       │
 │  redireciona pra     │                    │                          │                       │
 │  admin.appmax.com.br │                    │                          │                       │
 │<──────────────────────────────────────────│                          │                       │
 │  você autoriza                            │                          │                       │
 │  (faz o papel do merchant) ───────────────>│                          │                       │
 │                      │                    │  GET url_callback?token= │                       │
 │                      │                    │─────────────────────────────────────────────────>│
 │                      │                    │                          │  POST /app/client/     │
 │                      │                    │                          │  generate (troca hash) │
 │                      │                    │<─────────────────────────────────────────────────│
 │                      │                    │  chama health check      │                       │
 │                      │                    │─────────────────────────>│                       │
 │                      │                    │  200 { external_id }     │                       │
 │                      │                    │<─────────────────────────│                       │
 │                      │                    │  { client_id, secret }   │                       │
 │                      │                    │─────────────────────────────────────────────────>│
 │  vê client_id/secret na tela, copia se precisar                      │                       │
 │<──────────────────────────────────────────────────────────────────────────────────────────────│
```

## 1. `POST /app/authorize`

[`lib/appmax/install.ts#L23`](lib/appmax/install.ts#L23) (`authorizeInstall`):

- Usa o **App UUID** (`APPMAX_APP_UUID`), não o Numerical ID — a doc não deixa
  isso óbvio.
- Manda `url_callback` apontando pra
  [`/api/setup/callback`](app/api/setup/callback/route.ts) — é pra onde a
  Appmax redireciona depois que você autoriza.
- Manda **os dois nomes** de campo pro domínio do Apple Pay —
  `domain_name` (singular) e `domain_names` (array) — porque a doc é
  inconsistente sobre qual a Appmax realmente lê.
- Devolve um `hash` de uso único e a `redirectUrl` pra tela de autorização.

Disparado por [`app/api/setup/install/route.ts`](app/api/setup/install/route.ts),
que só redireciona (`NextResponse.redirect`) pra `redirectUrl`.

## 2. Você autoriza como merchant

Nesse fluxo de teste, você mesmo desempenha o papel do merchant sendo
instalado — é a mesma pessoa criando o app E autorizando a instalação. Em
produção real, quem autoriza é o lojista de verdade.

## 3. A Appmax chama `url_callback` com `?token=<hash>`

Cai em [`app/api/setup/callback/route.ts`](app/api/setup/callback/route.ts),
que lê o `token` da query string e chama `generateMerchantClient(hash)`.

## 4. `POST /app/client/generate`

[`lib/appmax/install.ts#L56`](lib/appmax/install.ts#L56)
(`generateMerchantClient`): troca o hash pelas credenciais do merchant
(`client_id`/`client_secret`). **É durante essa chamada, do lado da Appmax,
que ela dispara o health check** contra a URL de validação que você colou no
painel do app ao criar o aplicativo.

⚠️ Se o health check falhar (próximo passo), a instalação inteira falha
aqui — mesmo que `/app/client/generate` em si estivesse OK.

## 5. Health check — `POST /api/appmax/validate`

[`app/api/appmax/validate/route.ts`](app/api/appmax/validate/route.ts) —
**precisa responder exatamente `200`** com `{ external_id }` (a doc é
explícita: `201`/`204` e outros `2xx` **não** valem).

Com uma ressalva deliberada: se o `external_id` gerado **não puder ser
persistido**, a rota responde `500` de propósito e derruba a instalação.
Responder `200` nesse caso registraria do lado da Appmax um id que este app
não teria — que é exatamente a fábrica de `404 "Merchant not found"` que a
gente passou dias caçando. Melhor falhar na instalação, com mensagem clara,
do que "concluir" e quebrar no primeiro pagamento.

O `external_id` devolvido aqui é o **mesmo valor** que o
`AppmaxScripts.init(...)` no front vai usar depois — por isso ele é
persistido no banco (linha do ambiente ativo, visível em
[`/configuracao`](app/configuracao/page.tsx)), sempre por cima do anterior.

E ele é **novo a cada requisição**, nunca reaproveitado. A
[doc](https://docs.appmax.com.br/guides/implementar-url-validacao) é
explícita: *"Gere um UUID novo a cada requisição do health check"* — a
Appmax **rejeita valores repetidos**, e quando o `external_id` enviado já
existe na base dela ele é descartado e substituído pelo `client_id` da
instalação. Reaproveitar era exatamente o que fazia o id salvo aqui não
existir do lado da Appmax, com sintoma só lá na frente: `404
{"message":"Merchant not found"}` em toda tokenização de cartão.

Esse banco é a **única** fonte: `getExternalId()` não olha env var nem
`state.json`. Um `APPMAX_EXTERNAL_ID` esquecido no `.env` vencia o valor
salvo pela instalação e fazia o SDK mandar um id desconhecido — 404
`{"message":"Merchant not found"}` no `/v1/payments/tokenize`, que chega no
front como o genérico `"Failed to tokenize card."`.

## 6. Resultado — credenciais do merchant

De volta em `app/api/setup/callback/route.ts`, as credenciais
(`client_id`/`client_secret`) chegam mascaradas no log (nunca em texto puro)
e são persistidas via `lib/appmax/state.ts` → `lib/db/credentials.ts`
(SQLite, uma linha por ambiente) — visíveis depois em
[`/configuracao`](app/configuracao/page.tsx).

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| `/app/authorize` retorna 401 | `APPMAX_APP_CLIENT_ID/SECRET` errados ou não preenchidos (env var ou `/configuracao`) |
| Health check nunca é chamado | URL de validação colada errada no painel do app — confira com `/setup` |
| Health check retorna 500 | Banco indisponível (filesystem somente-leitura) — não há onde persistir o `external_id` |
| Checkout diz "external_id não configurado" | A linha do ambiente ativo está sem `external_id`: rode a instalação, ou cole o valor em `/configuracao` |
| Callback cai em erro "hash inválido" | Reusou um `token` de uma tentativa anterior — cada `/app/authorize` gera um hash de uso único |
| Credenciais do merchant não aparecem em `/configuracao` | Filesystem somente-leitura (serverless) — copie da tela de resultado do callback pras env vars manualmente |
