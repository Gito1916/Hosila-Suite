import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://hosila.com',
  output: 'static',
  outDir: '../.docs-dist',
  integrations: [
    starlight({
      title: 'Hosila Guides',
      tagline: 'Step-by-step setup, reception, dining, inventory, and licensing guides for hospitality teams.',
      favicon: '/favicon.svg',
      logo: {
        src: './src/assets/hosila-icon.svg',
        alt: 'Hosila',
      },
      customCss: ['./src/styles/starlight-hosila.css'],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'color-scheme',
            content: 'light dark',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'robots',
            content: 'index, follow',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'sitemap',
            href: '/sitemap.xml',
          },
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'User Guides Home', slug: 'docs' },
            { label: 'Windows Installation', slug: 'docs/getting-started/installation' },
            { label: 'Licensing & Activation', slug: 'docs/getting-started/licensing-and-activation' },
          ],
        },
        {
          label: 'Hosila PMS (Hotels)',
          items: [
            { label: 'Multi-Desk Hotel Wi-Fi Setup', slug: 'docs/pms/lan-sync-setup' },
            { label: 'Front Desk, Chart & Guest Bills', slug: 'docs/pms/front-desk-and-folios' },
            { label: 'Hotel Restaurant & Daily Accounts', slug: 'docs/pms/restaurant-and-accounting' },
          ],
        },
        {
          label: 'Hosila IMS (Stores)',
          items: [
            { label: 'Catalog, Crates & Stock Costing', slug: 'docs/ims/catalog-and-uom' },
            { label: 'Stock Issues & Market Excel Import', slug: 'docs/ims/collections-and-procurement-parser' },
          ],
        },
        {
          label: 'Backups & New PCs',
          items: [
            { label: 'Backups & Moving to a New PC', slug: 'docs/licensing/backups-and-migration' },
          ],
        },
      ],
    }),
  ],
});
