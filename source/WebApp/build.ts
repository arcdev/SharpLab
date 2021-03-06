// Common:
import path from 'path';
import { task, exec, build } from 'oldowan';
import jetpack from 'fs-jetpack';
import md5File from 'md5-file/promise';
// CSS:
import lessRender from 'less';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore (no typings)
import csso from 'postcss-csso';
// Favicons:
import sharp from 'sharp';
// HTML:
import htmlMinifier from 'html-minifier';

const dirname = __dirname;

const outputRoot = `${dirname}/wwwroot`;

const parallel = (...promises: ReadonlyArray<Promise<unknown>>) => Promise.all(promises);

const paths = {
    from: {
        less: `${dirname}/less/app.less`,
        favicon: `${dirname}/favicon.svg`,
        html: `${dirname}/index.html`
    },
    to: {
        css: `${outputRoot}/app.min.css`,
        favicon: {
            svg: `${outputRoot}/favicon.svg`,
            png: `${outputRoot}/favicon-{size}.png`
        },
        html: `${outputRoot}/index.html`
    }
};

const less = task('less', async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const content = (await jetpack.readAsync(paths.from.less))!;
    let { css, map } = await lessRender.render(content, {
        filename: paths.from.less,
        sourceMap: {
            sourceMapBasepath: `${dirname}`,
            outputSourceFiles: true
        }
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore (need to sort out 'map' type here)
    ({ css, map } = await postcss([
        autoprefixer,
        // no typings for csso
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        csso({ restructure: false })
    ]).process(css, {
        from: paths.from.less,
        map: {
            inline: false,
            prev: map
        }
    }));

    await parallel(
        jetpack.writeAsync(paths.to.css, css),
        jetpack.writeAsync(paths.to.css + '.map', map)
    );
}, { inputs: [`${dirname}/less/**/*.less`] });

const tsLint = task('tsLint', () => exec('eslint . --max-warnings 0 --ext .js,.ts'));

const ts = task('ts', async () => {
    await tsLint();
    await exec('rollup -c');
}, {
    inputs: [
        `${dirname}/ts/**/*.ts`,
        `${dirname}/components/**/*.ts`,
        `${dirname}/package.json`
    ]
});

const favicons = task('favicons', async () => {
    await jetpack.dirAsync(outputRoot);
    const pngGeneration = [16, 32, 64, 96, 128, 196, 256].map(size => {
        // https://github.com/lovell/sharp/issues/729
        const density = size > 128 ? Math.round(72 * size / 128) : 72;
        return sharp(paths.from.favicon, { density })
            .resize(size, size)
            .png()
            .toFile(paths.to.favicon.png.replace('{size}', size.toString()));
    });

    return parallel(
        jetpack.copyAsync(paths.from.favicon, paths.to.favicon.svg, { overwrite: true }),
        ...pngGeneration
    ) as unknown as Promise<void>;
}, { inputs: [paths.from.favicon] });

const html = task('html', async () => {
    const faviconDataUrl = await getFaviconDataUrl();
    const templates = await getCombinedTemplates();
    const [jsHash, cssHash] = await parallel(
        md5File('wwwroot/app.min.js'),
        md5File('wwwroot/app.min.css')
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let html = (await jetpack.readAsync(paths.from.html))!;
    html = html
        .replace('{build:js}', 'app.min.js?' + jsHash)
        .replace('{build:css}', 'app.min.css?' + cssHash)
        .replace('{build:templates}', templates)
        .replace('{build:favicon-svg}', faviconDataUrl);
    html = htmlMinifier.minify(html, { collapseWhitespace: true });
    await jetpack.writeAsync(paths.to.html, html);
}, {
    inputs: [
        `${dirname}/components/**/*.html`,
        paths.to.css,
        `${outputRoot}/app.min.js`,
        paths.from.html,
        paths.from.favicon
    ]
});

task('default', () => {
    const htmlAll = async () => {
        await parallel(less(), ts());
        await html();
    };

    return parallel(
        favicons(),
        htmlAll()
    ) as unknown as Promise<void>;
});

async function getFaviconDataUrl() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const faviconSvg = (await jetpack.readAsync(paths.from.favicon))!;
    // http://codepen.io/jakob-e/pen/doMoML
    return faviconSvg
        .replace(/"/g, '\'')
        .replace(/%/g, '%25')
        .replace(/#/g, '%23')
        .replace(/{/g, '%7B')
        .replace(/}/g, '%7D')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/\s+/g, ' ');
}

async function getCombinedTemplates() {
    const basePath = `${dirname}/components`;
    const htmlPaths = await jetpack.findAsync(basePath, { matching: '*.html' });
    const htmlPromises = htmlPaths.map(async htmlPath => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const template = (await jetpack.readAsync(htmlPath))!;
        const minified = htmlMinifier.minify(template, { collapseWhitespace: true });
        return `<script type="text/x-template" id="${path.basename(htmlPath, '.html')}">${minified}</script>`;
    });
    return (await Promise.all(htmlPromises)).join('\r\n');
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
build();