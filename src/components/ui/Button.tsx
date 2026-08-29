/**
 * Button primitives (spec 08/33). Every interactive control shares these so
 * hit areas (≥44 px on touch), focus rings, and variants can't drift apart.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

const VARIANTS = {
  primary:
    "bg-trail-600 text-white hover:bg-trail-700 active:bg-trail-800 " +
    "dark:bg-trail-500 dark:hover:bg-trail-600",
  secondary:
    "border border-trail-300 bg-white text-trail-800 hover:bg-trail-50 " +
    "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
  ghost: "text-trail-700 hover:bg-trail-100 dark:text-slate-300 dark:hover:bg-slate-800",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm " +
        "font-medium transition-colors focus-visible:outline focus-visible:outline-2 " +
        "focus-visible:outline-offset-2 focus-visible:outline-trail-600 disabled:opacity-40 " +
        `${VARIANTS[variant]} ${className}`
      }
      {...props}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls are invisible to screen readers without it. */
  "aria-label": string;
  variant?: ButtonVariant;
  children: ReactNode;
}

export function IconButton({ variant = "ghost", className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={
        "inline-flex h-11 w-11 items-center justify-center rounded-lg text-lg " +
        "transition-colors focus-visible:outline focus-visible:outline-2 " +
        "focus-visible:outline-offset-2 focus-visible:outline-trail-600 disabled:opacity-40 " +
        `${VARIANTS[variant]} ${className}`
      }
      {...props}
    />
  );
}
