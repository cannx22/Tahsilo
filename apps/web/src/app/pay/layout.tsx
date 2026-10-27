import { Lock } from 'lucide-react';
import { Logo } from '@/components/logo';

export const metadata = { title: 'Güvenli ödeme' };

export default function PayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
          <Lock className="h-3 w-3" /> Kart bilgileriniz Tahsilo'ya iletilmez; ödeme sağlayıcısının güvenli sayfasında alınır.
        </p>
      </div>
    </div>
  );
}
