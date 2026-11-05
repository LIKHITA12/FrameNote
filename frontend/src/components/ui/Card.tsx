import { HTMLAttributes } from "react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl2 border border-border bg-surface p-6 shadow-card transition-shadow duration-200 hover:shadow-card-hover ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
