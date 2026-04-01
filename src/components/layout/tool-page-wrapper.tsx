"use client";

import { motion } from "framer-motion";

interface ToolPageWrapperProps {
  title: string;
  description: string;
  category?: string;
  children: React.ReactNode;
}

export function ToolPageWrapper({
  title,
  description,
  children,
}: ToolPageWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="p-6 max-w-7xl mx-auto w-full"
    >
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-text mb-2 text-glow">
          {title}
        </h1>
        <p className="text-sub">{description}</p>
      </div>
      {children}
    </motion.div>
  );
}
