
module.exports = {
    capitalizeString: (str) => {
        if (typeof str !== 'string') return ''

        return str.length > 1 ?
            (
                str.charAt(0).toUpperCase() + str.slice(1))
            : (
                str.charAt(0).toUpperCase()
            )
    }
}


