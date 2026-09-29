import { useEffect, useState } from "react";

export function useShowMore(resetKey: string, pageSize = 40): { count: number; showMore: () => void } {
  const [count, setCount] = useState(pageSize);
  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);
  return { count, showMore: () => setCount((current) => current + pageSize) };
}
