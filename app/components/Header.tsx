import Link from "next/link";
import EnvironmentSwitcher from "./EnvironmentSwitcher";

/**
 * Header compartilhado entre as páginas — marca roxa, navegação e o
 * seletor de ambiente ativo (sandbox/produção). Mantido como Server
 * Component; cada link usa `next/link` para navegação client-side normal.
 * O seletor em si (`EnvironmentSwitcher`) é client component — busca o
 * ambiente atual via API pra não ficar preso ao build estático das páginas.
 */
export default function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 bg-am-dark px-6 py-4 text-white">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold">
        <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] bg-am-purple">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2 3 8v8l9 6 9-6V8l-9-6Z"
              stroke="white"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        Appmax × Next.js
      </Link>
      <nav className="flex items-center gap-5 text-sm">
        <Link href="/" className="text-[#b9b6d6] hover:text-white">
          Checkout
        </Link>
        <Link href="/setup" className="text-[#b9b6d6] hover:text-white">
          Setup
        </Link>
        <Link href="/configuracao" className="text-[#b9b6d6] hover:text-white">
          Configuração
        </Link>
        <EnvironmentSwitcher />
      </nav>
    </header>
  );
}
