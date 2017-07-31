var glob = require('glob');
var childProcess = require('child_process');
var fs = require('fs-extra');
var tmp = require('tmp');
var path = require('path');

function isPlatformWindows() {
    return /^win/.test(process.platform);
}

function node_exe(prog) {
    return isPlatformWindows()
        ? "node_modules\\.bin\\" + prog + ".cmd"
        : "./node_modules/.bin/" + prog;
}

function tool_path(tool) {
    var p = path.relative(process.cwd(), __dirname);
    return path.join(p, tool);
}

var MAX_CMD_LINE_LENGTH = isPlatformWindows()
    ? 7000 // Windows has a max length of 8191, but we need some spare room
    : 100000; // RHEL 5.11 <https://stackoverflow.com/questions/6846263/maximum-length-of-command-line-argument-that-can-be-passed-to-sqlplus-from-lin/6871471#6871471>

function argsLength(args) {
    var length = 0;
    args.forEach(function (arg) {
        length += arg.length + 1;
    });
    return length;
}

function runWithChunkedArgs(args, action) {
    var argsClone = args.slice();
    var takenArgs = [];
    while (argsClone.length > 0) {
        while (argsClone.length > 0 && argsLength(takenArgs) < MAX_CMD_LINE_LENGTH) {
            takenArgs.push(argsClone.shift());
        }
        action(takenArgs);
        takenArgs = [];
    }
}

function tsformat_files(files) {
    runWithChunkedArgs(files, function (chunked) {
        var p = childProcess.spawnSync(
            node_exe('tsfmt'),
            ['-r'].concat(chunked),
            { stdio: '' });

        if (p.error) {
            throw p.error;
        }
    });
}

function tslint_files(files) {
    runWithChunkedArgs(files, function (chunked) {
        var p = childProcess.spawnSync(
            node_exe('tslint'),
            ['--fix'].concat(chunked),
            { stdio: '' });

        if (p.error) {
            throw p.error;
        }
    });
}

function check_files(files, fix) {
    var foundErrors = false;

    var tmpobj = tmp.dirSync({ unsafeCleanup: true });
    try {
        function file_mirror(file) {
            return path.join(tmpobj.name, file);
        }

        files.forEach(function (file) {
            fs.copySync(file, file_mirror(file));
        });

        var p;

        tsformat_files(files.map(file_mirror));
        tslint_files(files.map(file_mirror));

        files.forEach(function (file) {
            var origContents = fs.readFileSync(file, "utf8");
            const mirrorContents = fs.readFileSync(file_mirror(file), "utf8");
            if (origContents !== mirrorContents) {
                if (fix) {
                    console.log("Fixing", file);
                    fs.writeFileSync(file, mirrorContents, { encoding: "utf8" });
                } else {
                    foundErrors = true;
                    try {
                        childProcess.execFileSync(
                            'python',
                            [tool_path('diffstyle.py'), file, '-c', file_mirror(file)],
                            { stdio: 'inherit' });
                    } catch (e) {
                        if (e.status) {
                            // We expected the command to return an exit code status error, but we still want to continue
                        } else {
                            // An unexpected error occurred
                            throw e;
                        }
                    }
                }
            }
        });
    } finally {
        tmpobj.removeCallback();
    }

    return foundErrors;
}

function print_usage() {
    console.log("USAGE:");
    console.log(process.argv0 + " " + process.argv[1] + " [--fix]");
    process.exit(1);
}

function parse_args() {
    var fix = false;
    if (process.argv.length === 2) {
    } else if (process.argv.length === 3) {
        if (process.argv[2] === "--fix") {
            fix = true;
        } else {
            print_usage();
        }
    } else {
        print_usage();
    }

    return {
        fix: fix
    }
}

function main() {
    var args = parse_args();

    glob('{./src/**/*.ts?(x),./helper_framework/**/*.ts?(x),./tests/**/*.ts?(x),./benchmarks/**/*.ts?(x)}', function (err, matches) {
        if (err) {
            console.error(err);
            process.exit(1);
        }

        var foundErrors = check_files(matches, args.fix);
        if (foundErrors) {
            process.exit(1);
        }
    });
}

main();
