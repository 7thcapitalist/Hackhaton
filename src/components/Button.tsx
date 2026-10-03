import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border border-accent font-semibold hover:brightness-110",
  secondary: "bg-surface text-ink border border-line shadow-xs font-medium hover:bg-surface-2",
  ghost: "text-accent font-medium hover:text-ink px-2",
};

export const buttonClass = (variant: Variant = "secondary", className = "") =>
  `inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 ${styles[variant]} ${className}`;

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
