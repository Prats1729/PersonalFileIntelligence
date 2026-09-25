import {google} from "googleapis"
import {Readable} from "stream"

// creates an authenticated GDrive client for a specific user using theit stored refresh token
function getDriveClient(refreshToken){
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    )

    auth.setCredentials({refresh_token: refreshToken})
    return google.drive({version: "v3", auth});
}

// uploads a file to users google drive
// @param {string} refreshToken - the users google oauth refresh token
// @param {Object} filr - the file object from multer (contains buffer, originalname, mimetype)
// @returns {promise<Object>} google drive fie metadata (id , name, webViewLink, etc)

export async function uploadFileToDrive(refreshToken, file){
    const drive = getDriveClient(refreshToken);

    // convert the buffer into readable stream for google's api
    const fileStream = Readable.from(file.buffer);

    const response = await drive.files.create({
        requestBody: {
            name: file.originalname,
            mimeType: file.mimetype,
        },
        media: {
            mimeType: file.mimetype,
            body: fileStream
        },
        fields: "id, name, mimeType, size, webViewLink",
    })
    return response.data;
}