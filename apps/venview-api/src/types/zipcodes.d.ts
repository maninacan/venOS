declare module 'zipcodes' {
  interface ZipInfo {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }
  function lookup(zip: string): ZipInfo | null;
  function lookupByCoords(lat: number, lng: number, radius?: number): ZipInfo[];
  function lookupByName(city: string, state: string): ZipInfo[];
}
