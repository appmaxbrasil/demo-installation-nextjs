import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Origens extras que podem pedir os assets de DEV do Next.
   *
   * Em desenvolvimento o Next bloqueia requisições cross-origin para
   * assets/endpoints de dev. Como este projeto só funciona de verdade por
   * trás de um túnel público HTTPS (a Appmax não alcança `localhost` nem pro
   * health check, nem pro Apple Pay), o navegador acessa por um domínio de
   * túnel e não por localhost — e aí os chunks do client levam 403.
   *
   * O sintoma é traiçoeiro: o HTML chega inteiro (SSR funciona), mas os
   * chunks do componente tomam 403 e o React nunca hidrata. A página fica
   * com cara de normal, os formulários simplesmente não reagem, e a
   * conclusão natural é "não está salvando no banco" — quando na verdade a
   * requisição de salvar nunca chegou a sair do navegador. O WebSocket do
   * HMR falhando junto é a outra metade do mesmo bloqueio.
   *
   * Curingas cobrem o subdomínio novo que o ngrok sorteia a cada restart no
   * plano free, senão isto vira manutenção a cada túnel levantado.
   *
   * Só vale em `next dev` — não afeta o build nem produção.
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.ngrok-free.dev",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
