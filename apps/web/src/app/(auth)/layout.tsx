import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-navy p-10 text-white lg:flex">
        <Logo light />
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Bir işletmenin finansal merkezi</h1>
          <p className="mt-3 max-w-md text-slate-300">
            Tahsilat, harcama, banka, kart, nakit akışı ve ERP bağlantılarınızı tek yerden görün ve yönetin.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-slate-300">
            <li>• Her verinin kaynağı ve güncelliği açıkça görünür</li>
            <li>• Ekstre içe aktarmada mükerrer kayıt oluşmaz</li>
            <li>• Kritik işlemler denetim izine yazılır</li>
          </ul>
        </div>
        <p className="text-xs text-slate-400">© {new Date().getFullYear()} Tahsilo</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
