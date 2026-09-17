const path = require('path');

process.env.BUILD_MODE = 'node';
const configs = require(path.join(process.cwd(), 'webpack.config.js'));
const node = configs.find((c) => c.target === 'node');

module.exports = {
  ...node,
  mode: 'development',
  devtool: false,
  externals: {},
  output: { ...node.output, path: process.env.FRACTCH_PACKAGER_OUT },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        loader: 'babel-loader',
        include: [path.join(process.cwd(), 'src')],
        options: { babelrc: false, presets: [['@babel/preset-env', { targets: { node: '12' } }]] },
      },
      ...node.module.rules,
    ],
  },
  plugins: node.plugins.filter((p) => p.constructor.name !== 'DefinePlugin'),
};
