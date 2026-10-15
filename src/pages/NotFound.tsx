import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

/** 404 — Urdu copy, RTL, and a way back into the product. */
export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      dir="rtl"
      className="flex min-h-screen flex-col"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-4xl font-bold text-foreground">404</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            یہ صفحہ موجود نہیں ہے
          </p>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            شاید لنک پرانا ہو گیا ہے یا صفحے کا پتہ غلط لکھا گیا ہے۔
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-bold transition hover:bg-muted"
          >
            صفحۂ اول پر واپس جائیں
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
