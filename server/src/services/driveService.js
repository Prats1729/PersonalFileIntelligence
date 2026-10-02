import {google} from "googleapis"
import {Readable} from "stream"

// creates an authenticated GDrive client for a specific user using theit stored refresh token
export function getDriveClient(refreshToken){
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

// Delete files from users drive
export async function deleteFileFromDrive(refreshToken, driveFileId){
    const drive = getDriveClient(refreshToken);

    await drive.files.delete({
        fileId: driveFileId
    });
}

export async function getDriveFolders(refreshToken){
    const drive = getDriveClient(refreshToken);
    const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id, name)",
    })
    return response.data.files;
}

// Creates a new folder in Google Drive
export async function createDriveFolder(refreshToken, folderName) {
  const drive = getDriveClient(refreshToken);
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id, name",
  });
  return response.data;
}
// Moves a file into a specific folder
export async function moveFileToFolder(refreshToken, fileId, folderId) {
  const drive = getDriveClient(refreshToken);
  
  // To move a file, we have to fetch its current parents, then add the new parent and remove the old ones
  const file = await drive.files.get({ fileId: fileId, fields: "parents" });
  const previousParents = file.data.parents ? file.data.parents.join(",") : "";
  await drive.files.update({
    fileId: fileId,
    addParents: folderId,
    removeParents: previousParents,
    fields: "id, parents",
  });
}