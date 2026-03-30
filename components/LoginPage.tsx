import { useState } from "react";
import { Button } from "./ui/button";
import { signInWithMicrosoft } from "../utils/authUtils";
import { AuroraText } from "./ui/aurora-text";

// Microsoft icon component
function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

interface LoginPageProps {
  onLogin?: () => void;
}

export default function LoginPage(_props: LoginPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleMicrosoftLogin = async () => {
    setError(null);
    setLoading(true);

    try {
      const { error } = await signInWithMicrosoft();
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left side - Hero content (60%) */}
      <div className="hidden lg:flex lg:w-[60%] bg-gradient-to-b from-slate-50 to-slate-100 relative">
        {/* Subtle pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />

        {/* Content - centered */}
        <div className="relative z-10 flex flex-col justify-center items-center w-full px-16 xl:px-24">
          <div className="max-w-xl text-center">
            {/* Headline */}
            <h1 className="text-5xl xl:text-6xl font-bold text-slate-900 tracking-tight mb-8 flex flex-col gap-4">
              <span>Complexity, solved.</span>
              <AuroraText
                className="font-bold"
                colors={["#10b981", "#0d9488", "#059669", "#0f766e"]}
                speed={4}
              >
                Focus, restored.
              </AuroraText>
            </h1>

            {/* Subheadline */}
            <p className="text-xl text-slate-600 leading-relaxed mb-12">
              Transform dense toxicology reports into sharp, actionable
              insights. Built for speed. Designed for precision.
            </p>

            {/* Stats or social proof */}
            <div className="flex items-center justify-center gap-8">
              <div>
                <div className="text-3xl font-bold text-slate-900">10x</div>
                <div className="text-sm text-slate-500">Faster extraction</div>
              </div>
              <div className="w-px h-12 bg-slate-200" />
              <div>
                <div className="text-3xl font-bold text-slate-900">98%</div>
                <div className="text-sm text-slate-500">Accuracy rate</div>
              </div>
              <div className="w-px h-12 bg-slate-200" />
              <div>
                <div className="text-3xl font-bold text-slate-900">500+</div>
                <div className="text-sm text-slate-500">Documents analyzed</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Sign in form (40%) */}
      <div className="w-full lg:w-[40%] flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 mb-4">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              Sign in
            </h2>
            <p className="text-slate-500">to continue to your workspace</p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Microsoft sign in button */}
          <Button
            onClick={handleMicrosoftLogin}
            disabled={loading}
            className="w-full h-12 text-[15px] font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-all duration-200"
          >
            {loading ? (
              <span className="flex items-center gap-3">
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Connecting...
              </span>
            ) : (
              <span className="flex items-center gap-3">
                <MicrosoftIcon className="w-5 h-5" />
                Continue with Microsoft
              </span>
            )}
          </Button>

          {/* Terms */}
          <p className="mt-8 text-center text-xs text-slate-400 leading-relaxed">
            By continuing, you agree to our{" "}
            <a href="#" className="text-slate-600 hover:underline">
              Terms
            </a>{" "}
            and{" "}
            <a href="#" className="text-slate-600 hover:underline">
              Privacy Policy
            </a>
          </p>

          {/* Mobile-only headline */}
          <div className="lg:hidden mt-12 pt-8 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Extract key information from documents in seconds
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
