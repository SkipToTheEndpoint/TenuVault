"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "~/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    indeterminate?: boolean
  }
>(({ className, indeterminate, ...props }, ref) => {
  // Filter out indeterminate from props to avoid DOM warning
  const checkboxProps = { ...props }
  
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer h-4 min-h-0 w-4 shrink-0 rounded-[5px] border border-gray-300 bg-white ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-coral-600 data-[state=checked]:border-coral-600 data-[state=checked]:text-white hover:border-gray-400 transition-colors duration-200",
        className
      )}
      {...checkboxProps}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        {indeterminate ? (
          <div className="h-2 w-2 bg-current" />
        ) : (
          <Check className="h-3 w-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }