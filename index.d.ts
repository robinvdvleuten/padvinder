/**
 * Compile a JSONPath query once, run it many times.
 *
 * @param {string} path The query, e.g. `'$.store.book[?@.price < 10].title'`.
 * @param {Record<string, Function>} [funcs] Custom function extensions callable in filters, alongside the built-in `length`, `count`, `value`, `match`, and `search`.
 * @returns {(data?: any) => any[]} Runner returning all matches (empty array for none).
 * @throws {SyntaxError} On malformed paths or filters.
 */
export function query(path: string, funcs?: Record<string, Function>): (data?: any) => any[];
/**
 * Compile and run a JSONPath query in one go.
 *
 * @param {string} path The query to run.
 * @param {any} [data] The data to query.
 * @param {Record<string, Function>} [funcs] Functions callable inside filters.
 * @returns {any[]} All matches (empty array for none).
 */
export function find(path: string, data?: any, funcs?: Record<string, Function>): any[];
