import { Suspense } from 'react';
import SearchPageContent from './SearchPageContent';
import SearchLoading from './loading';

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchLoading />}>
      <SearchPageContent />
    </Suspense>
  );
}
