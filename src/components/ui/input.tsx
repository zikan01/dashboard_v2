import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-btn border border-border bg-white px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-green-700",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[80px] w-full resize-y rounded-btn border border-border bg-white p-3 font-sans text-[13px] outline-none placeholder:text-faint focus:border-green-700",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full rounded-btn border border-border bg-white px-3 py-[9px] text-[13px] outline-none focus:border-green-700",
      className
    )}
    {...props}
  />
));
Select.displayName = "Select";

export { Input, Textarea, Select };
