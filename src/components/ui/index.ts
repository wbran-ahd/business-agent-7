/**
 * UI Component Registry — live exports only.
 *
 * Audit 1.3.1 (SAU-101): 43 of the 47 shadcn files in this folder were never
 * imported anywhere in the app and have been deleted. The barrel now exports
 * only the five survivors that the code actually consumes:
 *
 *   • button       — NotFound, instrumentation, lib/confirm, Radix variants
 *   • dialog       — instrumentation, lib/confirm, sheet internals
 *   • collapsible  — instrumentation
 *   • sheet        — components/layout/AppShell
 *   • sonner       — main.tsx (Toaster)
 *
 * When a new UI component is genuinely needed, add the file *and* an export
 * here in the same change — `bun tsc -b --noEmit` will not catch a file that
 * nothing imports, so a re-added dead file is invisible to every check.
 */
export { Button } from "./button";
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
export {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
export { Toaster } from "./sonner";
