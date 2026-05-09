import { BookOpen, Star, Clock, ArrowRight, Filter } from "lucide-react";

const publishedBooks = [
  {
    title: "The Bilingual Executive",
    subtitle: "Navigate Dual-Language Leadership in Global Finance",
    cover: "/covers/bilingual-executive.jpg",
    href: "/books/the-bilingual-executive",
    progress: 100,
    status: "Published",
  },
];

const readingList = [
  {
    title: "Thinking in Systems",
    author: "Donella H. Meadows",
    cover: "/covers/thinking-in-systems.jpg",
    href: "/books/thinking-in-systems",
    progress: 72,
    rating: 5,
  },
  {
    title: "Team Topologies",
    author: "Matthew Skelton & Manuel Pais",
    cover: "/covers/team-topologies.jpg",
    href: "/books/team-topologies",
    progress: 45,
    rating: 4,
  },
  {
    title: "Accelerate",
    author: "Nicole Forsgren et al.",
    cover: "/covers/accelerate.jpg",
    href: "/books/accelerate",
    progress: 100,
    rating: 5,
  },
];

export default function BooksPage() {
  return (
    <div>
      {/* Hero */}
      <header className="pt-8 mb-12">
        <div className="label-mono mb-2">Library</div>
        <div className="mt-1.5 w-8 h-0.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent2)] mb-4" />
        <h1 className="text-h3 md:text-h2 font-bold tracking-tight">
          <span className="gradient-text">Books</span> & Reading
        </h1>
        <p className="text-body text-sub mt-2 max-w-lg">
          Published works, reading notes, and the books that shape how I think
          about leadership, technology, and delivery.
        </p>
      </header>

      {/* Published works */}
      <section className="mb-14">
        <h2 className="label-mono mb-4 flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5" />
          Published Works
        </h2>
        <div className="space-y-3">
          {publishedBooks.map((book) => (
            <a
              key={book.title}
              href={book.href}
              className="book-card group"
            >
              {/* Cover */}
              <div className="w-14 h-20 rounded-md bg-[var(--card)] border border-border flex-shrink-0 overflow-hidden mr-4 relative z-[1]">
                <div className="w-full h-full bg-gradient-to-br from-accent/20 to-accent-2/20 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-accent opacity-60" />
                </div>
              </div>
              <div className="flex-1 relative z-[1]">
                <div className="text-sm font-semibold text-text">
                  {book.title}
                </div>
                <div className="font-mono text-tiny text-sub mt-0.5">
                  {book.subtitle}
                </div>
                <span className="inline-block mt-2 font-mono text-nano tracking-wider uppercase px-2 py-0.5 rounded-xs bg-[rgba(34,197,94,0.12)] text-[#22c55e] border border-[rgba(34,197,94,0.2)]">
                  {book.status}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-sub opacity-40 group-hover:opacity-100 group-hover:text-accent group-hover:translate-x-0.5 transition-all duration-300 relative z-[1]" />
              {/* Shimmer overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100">
                <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,var(--glow)_50%,transparent_60%)] -translate-x-full group-hover:animate-shimmer" />
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Reading list */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="label-mono flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Reading List
          </h2>
          <button className="flex items-center gap-1.5 text-sub text-tiny hover:text-accent transition-colors duration-200">
            <Filter className="w-3 h-3" />
            Filter
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {readingList.map((book) => (
            <a
              key={book.title}
              href={book.href}
              className="book-card group flex-col items-start gap-3"
            >
              {/* Book info */}
              <div className="flex items-center gap-3 w-full relative z-[1]">
                <div className="w-10 h-14 rounded bg-[var(--card)] border border-border flex-shrink-0 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-accent opacity-50" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text truncate">
                    {book.title}
                  </div>
                  <div className="font-mono text-tiny text-sub">
                    {book.author}
                  </div>
                </div>
              </div>

              {/* Rating + Progress */}
              <div className="flex items-center justify-between w-full relative z-[1]">
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${
                        i < book.rating
                          ? "text-[#fbbf24] fill-[#fbbf24]"
                          : "text-sub opacity-30"
                      }`}
                    />
                  ))}
                </div>
                <span className="font-mono text-nano text-sub">
                  {book.progress}%
                </span>
              </div>

              {/* Progress bar — accent gradient */}
              <div className="reading-progress w-full relative z-[1]">
                <div
                  className="reading-progress-fill"
                  style={{ width: `${book.progress}%` }}
                />
              </div>

              {/* Shimmer */}
              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100">
                <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,var(--glow)_50%,transparent_60%)] -translate-x-full group-hover:animate-shimmer" />
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
