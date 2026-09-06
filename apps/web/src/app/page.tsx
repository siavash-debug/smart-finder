const PLANNED_CAPABILITIES = [
  {
    title: "تطابق دقیق و نزدیک",
    body: "آگهی‌هایی که همهٔ شرط‌های شما را دارند، و آن‌هایی که فقط در یک مورد فاصله دارند — با ذکر همان مورد.",
  },
  {
    title: "تشخیص آگهی تکراری",
    body: "یک ملک که چند بنگاه آگهی کرده‌اند، یک بار نمایش داده می‌شود؛ مگر آنکه اطمینان کافی نباشد.",
  },
  {
    title: "پیگیری تغییر قیمت",
    body: "تاریخچهٔ قیمت هر آگهی نگه داشته می‌شود و کاهش قیمت به شما اطلاع داده می‌شود.",
  },
  {
    title: "اطلاع‌رسانی در تلگرام",
    body: "به‌جای جست‌وجوی هر روزه، وقتی مورد مناسبی پیدا شد به شما خبر داده می‌شود.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-10 px-5 py-12 sm:py-20">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-(--color-brand)">خانه‌یاب · تهران</p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">چه خانه‌ای می‌خواهید؟</h1>
        <p className="text-base leading-relaxed text-(--color-ink-muted)">
          خواسته‌تان را با زبان خودتان بنویسید یا فرم را پر کنید. ما آگهی‌های آپارتمان‌های فروشی
          تهران را دنبال می‌کنیم و وقتی موردی مطابق خواستهٔ شما پیدا شد خبر می‌دهیم.
        </p>
      </header>

      <section aria-labelledby="capabilities-heading" className="flex flex-col gap-4">
        <h2 id="capabilities-heading" className="text-lg font-semibold">
          چه کاری انجام می‌دهد
        </h2>
        <ul className="flex flex-col gap-3">
          {PLANNED_CAPABILITIES.map((capability) => (
            <li
              key={capability.title}
              className="rounded-xl border border-(--color-line) bg-(--color-surface-muted) p-4"
            >
              <h3 className="mb-1 text-base font-semibold">{capability.title}</h3>
              <p className="text-sm leading-relaxed text-(--color-ink-muted)">{capability.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="status-heading"
        className="rounded-xl border border-dashed border-(--color-line) p-4"
      >
        <h2 id="status-heading" className="mb-1 text-base font-semibold">
          وضعیت فعلی
        </h2>
        <p className="text-sm leading-relaxed text-(--color-ink-muted)">
          این نسخه هنوز آگهی‌ای جمع‌آوری نمی‌کند و جست‌وجو در دسترس نیست. زیرساخت پروژه راه‌اندازی
          شده و ساخت پایگاه داده و موتور تطابق مرحلهٔ بعدی است.
        </p>
      </section>

      <footer className="mt-auto pt-4 text-xs text-(--color-ink-muted)">
        اطلاعات نامشخص هرگز حدس زده نمی‌شود و با برچسب «نامشخص» نمایش داده می‌شود.
      </footer>
    </main>
  );
}
