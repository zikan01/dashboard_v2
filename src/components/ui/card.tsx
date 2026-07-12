import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-white p-5 shadow-card",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "flex items-center gap-2 text-[14.5px] font-bold",
        className
      )}
      {...props}
    />
  );
}

export function CardCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-3.5 mt-1 text-[11.5px] text-muted", className)} {...props} />
  );
}
