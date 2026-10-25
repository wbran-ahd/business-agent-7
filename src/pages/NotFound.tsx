import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.svg";
import { ArrowRight, Home } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950 text-white font-sans text-center">
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl shadow-2xl flex flex-col items-center">
        <img
          src={logo}
          alt="صوتی بقیہ لوگو"
          width={72}
          height={72}
          className="mb-4 drop-shadow-md"
        />
        <span className="text-6xl font-extrabold text-sky-400 mb-2">404</span>
        <h1 className="text-xl font-bold mb-2">صفحہ دستیاب نہیں ہے</h1>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          معذرت، آپ کی مطلوبہ دستاویز یا صفحہ منتقل ہو چکا ہے یا موجود نہیں۔
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
          <Button asChild className="gap-2 bg-sky-500 hover:bg-sky-600 text-white">
            <Link to="/dashboard">
              <Home className="w-4 h-4" />
              کھاتہ ڈیش بورڈ پر جائیں
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/10">
            <Link to="/">
              مرکزی صفحہ
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
