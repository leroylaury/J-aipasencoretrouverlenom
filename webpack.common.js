const path = require('path');
const webpack = require('webpack');
require('dotenv').config();

module.exports = {
  entry: {
    app: './assets/js/app.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: './assets/js/app.js',
    module: true,
  },
  experiments: {
    outputModule: true,
  },
  externalsType: 'module',
  plugins: [
    new webpack.DefinePlugin({
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || 'https://jtasqbcdkzocinxvtujs.supabase.co'),
      'process.env.SUPABASE_KEY': JSON.stringify(process.env.SUPABASE_KEY || 'sb_publishable_nRv-Tfo3J9UE5hm0qLJT0A_i116YPuh'),
    }),
  ],
};
