/** @type {import('next').NextConfig} */
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@agents': path.resolve(__dirname, '../agents'),
      '@lib': path.resolve(__dirname, '../lib'),
      '@data': path.resolve(__dirname, '../data'),
    }
    return config
  },
}

export default nextConfig
