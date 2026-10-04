import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border border-accent font-medium hover:brightness-110",
  secondary: "bg-surface text-ink border border-line font-medium hover:bg-surface-2 hover:border-ink-4",
  ghost: "text-accent font-medium hover:bg-accent-soft px-2",
};

export const buttonClass = (variant: Variant = "secondary", className = "") =>
  `inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] whitespace-nowrap transition-colors active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 disabled:active:translate-y-0 ${styles[variant]} ${className}`;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode };

export function Button({ variant = "secondary", icon, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; icon?: ReactNode };

/** Same look as Button, for navigation and downloads. */
export function ButtonLink({ variant = "secondary", icon, className = "", children, href, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass(variant, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
